package com.acme.orders.inject.business;

import javax.ejb.Local;

@Local
public class BareBean {
}

@Local(Interfaces.class)
class ConcreteBean {
}

@Local({Missing.class, Holder.Part.class})
class UnknownBean {
}
