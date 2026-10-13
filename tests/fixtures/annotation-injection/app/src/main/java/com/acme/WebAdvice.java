package com.acme;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.web.bind.annotation.ControllerAdvice;

@ControllerAdvice(basePackages = "com.acme.web")
public class WebAdvice {
    @Qualifier("orderDao")
    private OrderDaoImpl dao;
}
