package com.acme.orders;

import java.util.List;

public interface OrderProcessorLocal {
    Order place(String customer);

    List<Order> findAll();
}
