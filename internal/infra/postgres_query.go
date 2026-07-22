package infra

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

type VolumeInfo struct {
	Name       string `json:"name"`
	Mountpoint string `json:"mountpoint,omitempty"`
	SizeBytes  int64  `json:"size_bytes"`
	Size       string `json:"size,omitempty"`
	Shared     bool   `json:"shared"`
}

// VolumeInfo returns the shared engine data volume (all group DBs live here).
func (p *Postgres) VolumeInfo(ctx context.Context) VolumeInfo {
	info := VolumeInfo{Name: "infra_firewifi_pgdata", Shared: true}
	for _, vol := range []string{"infra_firewifi_pgdata", "firewifi_pgdata"} {
		out, err := exec.CommandContext(ctx, "sudo", "-n", "docker", "volume", "inspect",
			"-f", "{{.Name}}\t{{.Mountpoint}}", vol).CombinedOutput()
		if err != nil {
			continue
		}
		line := strings.TrimSpace(string(out))
		parts := strings.SplitN(line, "\t", 2)
		if len(parts) < 1 || parts[0] == "" {
			continue
		}
		info.Name = parts[0]
		if len(parts) >= 2 {
			info.Mountpoint = parts[1]
			if du, err := exec.CommandContext(ctx, "sudo", "-n", "du", "-sb", parts[1]).CombinedOutput(); err == nil {
				fields := strings.Fields(string(du))
				if len(fields) >= 1 {
					var n int64
					fmt.Sscanf(fields[0], "%d", &n)
					info.SizeBytes = n
					info.Size = formatBytes(n)
				}
			}
		}
		return info
	}
	return info
}

func formatBytes(n int64) string {
	if n < 1024 {
		return fmt.Sprintf("%d B", n)
	}
	f := float64(n)
	units := []string{"KB", "MB", "GB", "TB"}
	u := -1
	for f >= 1024 && u < len(units)-1 {
		f /= 1024
		u++
	}
	if u < 0 {
		return fmt.Sprintf("%d B", n)
	}
	if f >= 10 {
		return fmt.Sprintf("%.0f %s", f, units[u])
	}
	return fmt.Sprintf("%.1f %s", f, units[u])
}

func (p *Postgres) Restart(ctx context.Context) error {
	_ = p.Stop(ctx)
	return p.Start(ctx)
}

type QueryResult struct {
	OK         bool       `json:"ok"`
	Columns    []string   `json:"columns,omitempty"`
	Rows       [][]string `json:"rows,omitempty"`
	RowCount   int        `json:"row_count"`
	Truncated  bool       `json:"truncated,omitempty"`
	Message    string     `json:"message,omitempty"`
	DurationMS int64      `json:"duration_ms"`
}

// Query runs SQL as the given role against dbName inside the engine container.
func (p *Postgres) Query(ctx context.Context, dbName, user, pass, sql string) (QueryResult, error) {
	res := QueryResult{}
	dbName = strings.TrimSpace(dbName)
	user = strings.TrimSpace(user)
	sql = strings.TrimSpace(sql)
	if dbName == "" || user == "" {
		return res, fmt.Errorf("database credentials missing")
	}
	if sql == "" {
		return res, fmt.Errorf("SQL required")
	}
	if len(sql) > 12000 {
		return res, fmt.Errorf("SQL too long")
	}
	if !identRe.MatchString(dbName) || !identRe.MatchString(user) {
		return res, fmt.Errorf("invalid database identity")
	}
	// Fast path for interactive SQL — avoid a long WaitHealthy loop.
	st := p.Status(ctx)
	if !st.Running {
		if err := p.WaitHealthy(ctx, 8*time.Second); err != nil {
			return res, err
		}
	}
	start := time.Now()
	qctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	script := "SET statement_timeout = '12s';\n" + sql
	// Direct docker exec so client abort cancels promptly (compose+sudo can linger).
	cmd := exec.CommandContext(qctx, "sudo", "-n", "docker", "exec", "-i",
		"-e", "PGPASSWORD="+pass,
		"firewifi-postgres",
		"psql", "-U", user, "-d", dbName,
		"-v", "ON_ERROR_STOP=1",
		"-P", "pager=off",
		"--csv",
		"-c", script,
	)
	out, err := cmd.CombinedOutput()
	res.DurationMS = time.Since(start).Milliseconds()
	text := strings.TrimSpace(string(out))
	if err != nil {
		if qctx.Err() != nil {
			return res, fmt.Errorf("cancelled")
		}
		msg := text
		if msg == "" {
			msg = err.Error()
		}
		if i := strings.LastIndex(msg, "ERROR:"); i >= 0 {
			msg = strings.TrimSpace(msg[i:])
		}
		return res, fmt.Errorf("%s", msg)
	}
	lines := strings.Split(text, "\n")
	clean := make([]string, 0, len(lines))
	for _, ln := range lines {
		ln = strings.TrimRight(ln, "\r")
		if ln == "" || strings.HasPrefix(ln, "SET") || strings.HasPrefix(ln, "Time:") {
			continue
		}
		clean = append(clean, ln)
	}
	if len(clean) == 0 {
		res.OK = true
		res.Message = "OK"
		return res, nil
	}
	if len(clean) == 1 && !strings.Contains(clean[0], ",") && !looksLikeCSVHeader(clean[0]) {
		res.OK = true
		res.Message = clean[0]
		return res, nil
	}
	res.Columns = parseCSVLine(clean[0])
	maxRows := 200
	for i := 1; i < len(clean); i++ {
		if i > maxRows {
			res.Truncated = true
			break
		}
		res.Rows = append(res.Rows, parseCSVLine(clean[i]))
	}
	res.RowCount = len(res.Rows)
	res.OK = true
	return res, nil
}

func looksLikeCSVHeader(s string) bool {
	return strings.Contains(s, ",") || (len(s) > 0 && s[0] == '"')
}

func parseCSVLine(s string) []string {
	var out []string
	var cur strings.Builder
	inQ := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		if inQ {
			if c == '"' {
				if i+1 < len(s) && s[i+1] == '"' {
					cur.WriteByte('"')
					i++
				} else {
					inQ = false
				}
			} else {
				cur.WriteByte(c)
			}
			continue
		}
		if c == '"' {
			inQ = true
			continue
		}
		if c == ',' {
			out = append(out, cur.String())
			cur.Reset()
			continue
		}
		cur.WriteByte(c)
	}
	out = append(out, cur.String())
	return out
}
