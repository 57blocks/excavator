package com.acme.orders.web;

import java.util.List;
import javax.enterprise.context.RequestScoped;
import javax.inject.Inject;
import javax.inject.Named;
import com.acme.orders.Order;
import com.acme.orders.OrderProcessorLocal;

@Named("orders")
@RequestScoped
public class OrderBean {
    @Inject
    private OrderProcessorLocal processor;

    public List<Order> getList() {
        return processor.findAll();
    }

    public String detail() {
        return "detail";
    }
}
