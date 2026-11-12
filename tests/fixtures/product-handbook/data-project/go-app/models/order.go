package models

type Order struct{ ID int }

func (Order) TableName() string {
	return "go_orders"
}
