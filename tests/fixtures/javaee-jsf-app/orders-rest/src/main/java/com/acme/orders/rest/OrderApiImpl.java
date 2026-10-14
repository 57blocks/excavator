package com.acme.orders.rest;

public class OrderApiImpl implements OrderApi {

    @Override
    public String list() {
        return "[]";
    }

    @Override
    public void create(String body) {
    }
}
