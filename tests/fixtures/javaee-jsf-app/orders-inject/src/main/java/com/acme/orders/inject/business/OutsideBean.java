package com.acme.orders.inject.business;

import javax.ejb.Remote;

@Remote(javax.management.MBeanServer.class)
public class OutsideBean {
}
