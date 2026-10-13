package com.acme.orders;

import javax.interceptor.AroundInvoke;
import javax.interceptor.InvocationContext;

public class AuditInterceptor {
    @AroundInvoke
    public Object audit(InvocationContext context) throws Exception {
        return context.proceed();
    }
}
