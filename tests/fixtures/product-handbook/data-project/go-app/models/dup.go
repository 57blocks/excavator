package models

const tableDup = "dup_one"

type Dup struct{}

func (Dup) TableName() string {
	return tableDup
}
