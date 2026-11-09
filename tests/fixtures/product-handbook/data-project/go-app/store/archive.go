package store

type Line struct {
	Items  []int `gorm:"many2many:order_items"`
	Others []int `gorm:"many2many:order_items_x;joinForeignKey:ID"`
}

func archive(db *DB) {
	db.Table("orders AS o").Find(&rows)
	db.Table("orders o").Find(&rows)
	db.Table("orders_archive").Find(&rows)
	db.Table("orders").Find(&rows)
}
