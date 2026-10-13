package com.acme;

import javax.annotation.Resource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

@Service("orderService")
public class OrderService {
    private static final String ORDER_NAME = "orderDao";

    @Autowired
    @Qualifier("orderDao")
    private OrderDaoImpl dao;

    @Resource(name = "orderDao")
    private OrderDaoImpl named;

    @Resource
    private AuditLog auditLog;

    private OrderDaoImpl injected;

    @Resource
    public void setOrderDao(OrderDaoImpl injected) {
        this.injected = injected;
    }

    @Resource
    private OrderDaoImpl missingDao;

    @Qualifier(ORDER_NAME)
    private OrderDaoImpl dynamic;

    public OrderService(@Qualifier("auditLog") AuditLog audit) {
    }

    @Qualifier("orderDao")
    public void wire(OrderDaoImpl other) {
    }

    static class Helper {
        @Resource(name = "orderDao")
        private OrderDaoImpl helperDao;

        @Resource
        private OrderDaoImpl goneDao;
    }
}
