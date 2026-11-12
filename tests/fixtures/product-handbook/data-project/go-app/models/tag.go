package models

type Name string

var TableTags Name = "tags"

type Tag struct{}

func (Tag) TableName() string {
	return consts.TableTags.String()
}
