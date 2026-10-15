package com.acme.orders.inject.types;

import javax.inject.Inject;

public class Box<T> {
    @Inject
    private T item;
}
