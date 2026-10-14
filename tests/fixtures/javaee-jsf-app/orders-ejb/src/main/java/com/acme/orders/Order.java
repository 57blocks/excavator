package com.acme.orders;

import javax.persistence.Entity;
import javax.persistence.Id;

@Entity
public class Order {
    @Id
    private Long id;
    private String customer;

    public Order() {
    }

    public Order(String customer) {
        this.customer = customer;
    }

    public Long getId() {
        return id;
    }

    public String getCustomer() {
        return customer;
    }
}
