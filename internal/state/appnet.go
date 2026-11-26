package state

import (
	"bufio"
	"context"
	"net"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// NetUser is one owner of internet connections on the Pi right now: an app
// container, cloudflared (public links) or one of the Pi's own processes.
type NetUser struct {
	Kind        string  `json:"kind"` // "app", "links" or "pi"
	Name        string  `json:"name"` // container name (fw-<group>-<slug>) or process name
	Connections int     `json:"connections"`
	RateBPS     float64 `json:"rate_bps"`
	InBPS       float64 `json:"in_bps"`  // responses and downloads arriving
	OutBPS      float64 `json:"out_bps"` // requests and uploads leaving
}

type netUsersCache struct {
	mu         sync.Mutex
	at         time.Time
	last       []NetUser
	prevBytes  map[string][2]uint64 // received, sent
	containers map[string]string    // docker id → name
	contAt     time.Time
}

const (
	netUsersTTL   = 3 * time.Second
	containersTTL = 30 * time.Second
)

var (
	ssPidPattern   = regexp.MustCompile(`\("([^"]+)",pid=(\d+)`)
	ssBytesPattern = regexp.MustCompile(`bytes_(sent|received):(\d+)`)
	dockerIDInPath = regexp.MustCompile(`[0-9a-f]{64}`)
)

// readNetUsers groups the Pi's internet connections by owner, with live byte
// rates from the kernel's per-socket counters. Local and private peers (the
// hotspot, Docker bridges, loopback) are ignored.
func (r *Reader) readNetUsers() []NetUser {
	c := &r.netUsers
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	if !c.at.IsZero() && now.Sub(c.at) < netUsersTTL {
		return c.last
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "sudo", "-n", "ss", "-tnpiH", "state", "established").Output()
	if err != nil {
		c.at = now
		return c.last
	}
	if now.Sub(c.contAt) >= containersTTL {
		c.containers = dockerContainerNames(ctx)
		c.contAt = now
	}
	owners := parseSS(string(out))
	type agg struct {
		user    NetUser
		in, out uint64
	}
	byKey := map[string]*agg{}
	for _, o := range owners {
		kind, name := classifyOwner(o.comm, o.pid, c.containers)
		key := kind + "/" + name
		a := byKey[key]
		if a == nil {
			a = &agg{user: NetUser{Kind: kind, Name: name}}
			byKey[key] = a
		}
		a.user.Connections++
		a.in += o.in
		a.out += o.out
	}
	secs := now.Sub(c.at).Seconds()
	nextPrev := map[string][2]uint64{}
	users := make([]NetUser, 0, len(byKey))
	for key, a := range byKey {
		nextPrev[key] = [2]uint64{a.in, a.out}
		if p, ok := c.prevBytes[key]; ok && secs > 0 && a.in >= p[0] && a.out >= p[1] {
			a.user.InBPS = float64(a.in-p[0]) / secs
			a.user.OutBPS = float64(a.out-p[1]) / secs
			a.user.RateBPS = a.user.InBPS + a.user.OutBPS
		}
		users = append(users, a.user)
	}
	sort.Slice(users, func(i, j int) bool {
		if users[i].RateBPS != users[j].RateBPS {
			return users[i].RateBPS > users[j].RateBPS
		}
		return users[i].Connections > users[j].Connections
	})
	c.prevBytes, c.last, c.at = nextPrev, users, now
	return users
}

type ssOwner struct {
	comm    string
	pid     int
	in, out uint64
}

// parseSS reads `ss -tnpiH` output: a socket line, then an indented info line.
func parseSS(out string) []ssOwner {
	var owners []ssOwner
	var cur *ssOwner
	s := bufio.NewScanner(strings.NewReader(out))
	s.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for s.Scan() {
		line := s.Text()
		if strings.HasPrefix(line, "\t") || strings.HasPrefix(line, " ") && cur != nil && !strings.Contains(line, "users:") {
			if cur != nil {
				for _, m := range ssBytesPattern.FindAllStringSubmatch(line, -1) {
					n, _ := strconv.ParseUint(m[2], 10, 64)
					if m[1] == "received" {
						cur.in += n
					} else {
						cur.out += n
					}
				}
			}
			continue
		}
		cur = nil
		fields := strings.Fields(line)
		if len(fields) < 5 || !publicPeer(fields[3]) {
			continue
		}
		m := ssPidPattern.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		pid, _ := strconv.Atoi(m[2])
		owners = append(owners, ssOwner{comm: m[1], pid: pid})
		cur = &owners[len(owners)-1]
	}
	return owners
}

// publicPeer reports whether host:port is an internet address.
func publicPeer(hostport string) bool {
	host, _, err := net.SplitHostPort(hostport)
	if err != nil {
		return false
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	if ip == nil {
		return false
	}
	return !(ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified())
}

func classifyOwner(comm string, pid int, containers map[string]string) (kind, name string) {
	if comm == "cloudflared" {
		return "links", "cloudflared"
	}
	if b, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/cgroup"); err == nil {
		if id := dockerIDInPath.FindString(string(b)); id != "" {
			if n, ok := containers[id]; ok {
				return "app", n
			}
			return "app", id[:12]
		}
	}
	return "pi", comm
}

func dockerContainerNames(ctx context.Context) map[string]string {
	names := map[string]string{}
	out, err := exec.CommandContext(ctx, "sudo", "-n", "docker", "ps", "--no-trunc", "--format", "{{.ID}} {{.Names}}").Output()
	if err != nil {
		return names
	}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if id, name, ok := strings.Cut(line, " "); ok {
			names[id] = name
		}
	}
	return names
}
