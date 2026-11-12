package com.acme;

public abstract class LookupHolder {
    public abstract OrderDao dao();

    public Object swapped(String arg) {
        return arg;
    }
}
