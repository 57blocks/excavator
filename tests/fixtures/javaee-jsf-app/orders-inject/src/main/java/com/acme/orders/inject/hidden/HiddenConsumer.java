package com.acme.orders.inject.hidden;

import javax.inject.Inject;

interface Auditor {
}

class AuditorImpl implements Auditor {
}

class AuditorHolder {
    static class Mock implements Auditor {
    }
}

interface Scheduler {
}

class SchedulerImpl implements Scheduler {
}

class SchedulerFactory {
    Scheduler make() {
        return new Scheduler() {
        };
    }
}

interface Exporter {
}

class ExporterImpl implements Exporter {
}

class ExporterFactory {
    void run() {
        class Local implements Exporter {
        }
    }
}

public class HiddenConsumer {
    @Inject
    private Auditor auditor;

    @Inject
    private Scheduler scheduler;

    @Inject
    private Exporter exporter;
}
