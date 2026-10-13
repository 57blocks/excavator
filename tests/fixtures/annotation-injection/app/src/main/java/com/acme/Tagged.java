package com.acme;

import javax.ejb.EJB;

public @interface Tagged {
    @EJB(beanName = "OrderBean")
    String BEAN = "";
}
