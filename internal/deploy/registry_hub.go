package deploy

import "sync"

const registryMaxSubs = 32

// RegistryEvent is a lightweight SSE signal that the service registry changed.
type RegistryEvent struct {
	Seq int `json:"seq"`
}

type registryHub struct {
	mu   sync.Mutex
	seq  int
	subs map[chan RegistryEvent]struct{}
}

func newRegistryHub() *registryHub {
	return &registryHub{subs: make(map[chan RegistryEvent]struct{})}
}

func (h *registryHub) Notify() {
	if h == nil {
		return
	}
	h.mu.Lock()
	h.seq++
	ev := RegistryEvent{Seq: h.seq}
	for ch := range h.subs {
		select {
		case ch <- ev:
		default:
		}
	}
	h.mu.Unlock()
}

func (h *registryHub) Subscribe() (<-chan RegistryEvent, func()) {
	ch := make(chan RegistryEvent, 4)
	if h == nil {
		close(ch)
		return ch, func() {}
	}
	h.mu.Lock()
	if len(h.subs) >= registryMaxSubs {
		h.mu.Unlock()
		close(ch)
		return ch, func() {}
	}
	h.subs[ch] = struct{}{}
	seq := h.seq
	h.mu.Unlock()
	select {
	case ch <- RegistryEvent{Seq: seq}:
	default:
	}
	cancel := func() {
		h.mu.Lock()
		if _, ok := h.subs[ch]; ok {
			delete(h.subs, ch)
			close(ch)
		}
		h.mu.Unlock()
	}
	return ch, cancel
}
