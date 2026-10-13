package com.acme;

import javax.ejb.EJB;

public class OrderFacade {
    private static final String BEAN = "OrderBean";

    @EJB(beanName = "OrderBean")
    private OrderBeanImpl orders;

    @EJB(beanName = "InvoiceBean")
    private InvoiceBean invoices;

    @EJB
    private InvoiceBean typed;

    @EJB(beanName = BEAN)
    private Object dynamic;

    @EJB(beanName = "NoSuchBean")
    private Object missing;

    @EJB(beanName = "orderDao")
    private Object spring;
}
