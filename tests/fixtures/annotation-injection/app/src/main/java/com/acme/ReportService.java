package com.acme;

import javax.annotation.Resource;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

@Service
public class ReportService {
    @Qualifier("nothing")
    private Object nothing;

    @Qualifier("svc")
    private Object factoryBuilt;

    @Qualifier("marker")
    private Object annotationType;

    @Resource(name = "dataSource")
    private Object dataSource;

    @Qualifier("store")
    private Object store;

    @Qualifier("cdiBean")
    private Object cdi;
}
