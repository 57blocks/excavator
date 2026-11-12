package models

type Note struct{ ID int }

func (n *Note) TableName() string {
	return "legacy_notes"
}
