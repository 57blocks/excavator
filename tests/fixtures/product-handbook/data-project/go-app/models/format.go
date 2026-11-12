package models

type Fmt struct{}

func (f Fmt) TableName() string {
	return fmt.Sprintf("fmt_%s", f.Suffix)
}
