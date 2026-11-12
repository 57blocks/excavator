package com.acme;

public class Overloaded {
    public static Object of(String name) {
        return name;
    }

    public static Object of(int count) {
        return count;
    }
}
