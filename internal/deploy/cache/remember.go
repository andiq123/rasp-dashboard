package cache

// Remember writes the fingerprints used for this successful build so the next
// redeploy can detect lockfile changes and choose hit vs refresh.
func (s *Store) Remember(group, slug string, layers ...Layer) error {
	st, err := s.LoadState(group, slug)
	if err != nil {
		return err
	}
	if st.Keys == nil {
		st.Keys = map[Kind]string{}
	}
	for _, l := range layers {
		if l.Key == "" {
			continue
		}
		st.Keys[l.Kind] = l.Key
	}
	return s.SaveState(group, slug, st.Keys)
}
