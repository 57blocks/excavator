package models

const tableAccounts = "accounts"

type Account struct{ ID int }

func (a *Account) TableName() string {
	return tableAccounts
}
