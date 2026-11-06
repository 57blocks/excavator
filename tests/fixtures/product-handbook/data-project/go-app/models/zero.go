package models

type Zero struct{}

func (Zero) TableName() string {
	return pkg.MissingName
}
