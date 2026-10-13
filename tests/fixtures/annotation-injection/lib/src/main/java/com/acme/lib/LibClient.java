package com.acme.lib;

import org.springframework.beans.factory.annotation.Qualifier;

public class LibClient {
    @Qualifier("orderDao")
    private Object dao;

    @Qualifier("libOnly")
    private Object only;
}
