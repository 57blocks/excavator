package com.acme.orders;

import java.util.List;

public interface OrderProcessorRemote {
    Order place(String customer);

    List<Order> findAll();
}
