package com.acme.custom;

import org.springframework.stereotype.Service;

@Service
public class Shadowed {
    @Qualifier("orderDao")
    private Object dao;
}
