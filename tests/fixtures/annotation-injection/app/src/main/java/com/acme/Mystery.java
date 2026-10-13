package com.acme;

import com.thirdparty.inject.*;

public class Mystery {
    @Qualifier("orderDao")
    private Object dao;
}
