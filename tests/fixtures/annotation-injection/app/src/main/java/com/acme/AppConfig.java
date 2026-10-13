package com.acme;

import javax.annotation.Resource;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AppConfig {
    @Resource(name = "auditLog")
    private AuditLog audit;
}
