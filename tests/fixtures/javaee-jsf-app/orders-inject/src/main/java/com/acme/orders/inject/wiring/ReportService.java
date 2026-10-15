package com.acme.orders.inject.wiring;

import javax.inject.Inject;

interface Clock {
}

class SystemClock implements Clock {
}

interface Mailer {
}

class SmtpMailer implements Mailer {
}

interface AuditTrail {
}

class DbAuditTrail implements AuditTrail {
}

public class ReportService {
    @Inject
    public ReportService(Clock clock, Mailer mailer) {
    }

    @Inject
    public void setAudit(AuditTrail audit) {
    }
}
