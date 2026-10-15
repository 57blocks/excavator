package com.acme.orders.inject.business;

import javax.ejb.Local;

interface Ledger {
}

@Local(Ledger.class)
public class LedgerBean implements Ledger {
}
