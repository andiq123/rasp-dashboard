package state

import (
	"errors"
	"testing"
)

func TestApplyEgressToleratesBlips(t *testing.T) {
	r := &Reader{}
	blip := egressResult{err: errors.New("Mullvad egress check failed")}

	r.applyEgress(blip)
	if r.vpnEgressOK {
		t.Fatal("an unverified exit must not pass")
	}
	r.applyEgress(egressResult{ok: true})
	if !r.vpnEgressOK {
		t.Fatal("verified exit should pass")
	}
	for i := 1; i < egressFailuresToFlip; i++ {
		r.applyEgress(blip)
		if !r.vpnEgressOK {
			t.Fatalf("verified exit flipped after %d blip(s)", i)
		}
	}
	r.applyEgress(blip)
	if r.vpnEgressOK {
		t.Fatalf("exit should fail after %d consecutive blips", egressFailuresToFlip)
	}
	r.applyEgress(egressResult{ok: true})
	if !r.vpnEgressOK || r.vpnEgressFails != 0 {
		t.Fatal("one success restores the exit")
	}
	r.applyEgress(egressResult{violation: true, err: errors.New("egress geolocated outside Romania (DE)")})
	if r.vpnEgressOK {
		t.Fatal("a non-Romanian exit must fail at once")
	}
}
