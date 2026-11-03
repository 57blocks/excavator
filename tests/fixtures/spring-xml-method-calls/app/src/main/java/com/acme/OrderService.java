package com.acme;

public class OrderService extends BaseService {
    public void start() {
        loadCache();
    }

    private void loadCache() {
        warm();
    }

    private void warm() {
    }

    public void stop() {
    }
}
