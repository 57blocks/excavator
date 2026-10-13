package com.acme;

import javax.annotation.Resource;
import javax.ejb.Stateless;

@Stateless(name = "OrderBean")
public class OrderBeanImpl {
    @Resource(name = "jdbc/main")
    private Object dataSource;

    @Resource
    private Object sessionContext;
}
