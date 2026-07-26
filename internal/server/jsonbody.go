package server

import (
	"encoding/json"
	"io"
	"net/http"
)

const maxJSONBody = 1 << 20 // 1 MiB

func decodeJSONBody(r *http.Request, dst any) error {
	defer r.Body.Close()
	return json.NewDecoder(io.LimitReader(r.Body, maxJSONBody)).Decode(dst)
}
