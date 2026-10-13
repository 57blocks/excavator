package com.acme.orders;

import java.util.List;
import javax.ejb.Stateless;
import javax.persistence.EntityManager;
import javax.persistence.PersistenceContext;

@Stateless
public class OrderProcessorBean implements OrderProcessorLocal {
    @PersistenceContext
    private EntityManager em;

    @Override
    public Order place(String customer) {
        Order order = new Order(customer);
        em.persist(order);
        return order;
    }

    @Override
    public List<Order> findAll() {
        return em.createQuery("select o from Order o", Order.class).getResultList();
    }
}
