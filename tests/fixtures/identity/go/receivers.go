package receivers

// A and B both have a Save method: same name, different owner.
type A struct{ id string }

type B struct{ id string }

func (a *A) Save() error {
	return nil
}

func (b B) Save() error {
	return nil
}

// A free function with the same name again — no owner at all.
func Save() error {
	return nil
}
