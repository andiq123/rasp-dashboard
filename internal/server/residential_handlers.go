package server

import (
	"math"
	"net/http"

	"firewifi/dashboard/internal/state"
)

// ResidentialBalanceStore saves the IPRoyal balance the owner reads off their dashboard.
type ResidentialBalanceStore interface {
	SetResidentialBalance(bytes uint64) (state.ResidentialUsage, error)
}

// handleResidentialBalance: POST {"gb": 0.79} (decimal GB, as IPRoyal shows it).
func (s *Server) handleResidentialBalance(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	store, ok := s.State.(ResidentialBalanceStore)
	if !ok {
		http.Error(w, "residential balance is not available", http.StatusNotImplemented)
		return
	}
	var body struct {
		GB float64 `json:"gb"`
	}
	if err := decodeJSONBody(r, &body); err != nil || body.GB < 0 || math.IsNaN(body.GB) || math.IsInf(body.GB, 0) {
		http.Error(w, "enter the remaining GB, for example 0.79", http.StatusBadRequest)
		return
	}
	u, err := store.SetResidentialBalance(uint64(math.Round(body.GB * 1e9)))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	jsonReply(w, u)
}
