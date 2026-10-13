package com.acme.seam;

import org.jboss.seam.annotations.In;
import org.jboss.seam.annotations.Name;

@Name("orderAction")
public class OrderAction {
    @In
    private CustomerList customerList;

    @In("billing")
    private BillingService svc;

    @In(create = true)
    private MailerImpl mailer;

    private Inventory stock;

    @In
    public void setInventory(Inventory stock) {
        this.stock = stock;
    }

    @In("#{currentUser.name}")
    private String userName;

    @In
    private JsfBean jsfOnly;

    @In
    private Object facesMessages;

    @In
    public void refresh() {
    }
}
