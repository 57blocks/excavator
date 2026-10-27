# Where intent sits in a Java EE system

A guide for the research passes of a Skopo recovery on a Java EE or Jakarta EE system (JSF, EJB,
CDI, JPA, JAX-RS, JMS). It says where rules, promises and decisions tend to live in such a system,
and how to find them. It is a hint, never evidence: cite the source you read.

`javax.*` and `jakarta.*` are the same APIs under two names; search for both.

With `GRAPH=available`, start from the facts: they hold the wiring a search cannot follow by name,
because the container joins the pieces by type, by an EL name or by a class written in a
descriptor. Follow a page to the beans its EL names (`references`), a bean to what it injects
(`injects`), a descriptor to the classes it lists (`mentions`) and a route to its handler
(`routes`) with `traverse`, then read each end. The tables below are where intent sits that the
facts do not turn into edges; search for those with `recall` or `Grep`.

## world

| Where | What it holds | How to find it |
|---|---|---|
| JPA entities | the domain's words, its states (`@Enumerated` enums) and their lifecycles | `@Entity`, `@Embeddable`, `@MappedSuperclass`; the `class` entries of `persistence.xml` |
| Bean Validation | limits and formats the domain promises: lengths, ranges, patterns, amounts | `@NotNull`, `@Size`, `@Min`, `@Max`, `@Pattern`, `@Digits`, `@DecimalMin`, `@Future`, `@Past`, custom `ConstraintValidator` classes |
| Cascades and orphan removal | what disappears with what, which records outlive their owner | `cascade =`, `orphanRemoval`, `@OnDelete` |
| Optimistic locking | which records two people may not change at once | `@Version` |
| Timers | time-driven rules: cut-offs, end of day, expiry, reminders | `@Schedule`, `@Schedules`, `@Timeout`, `TimerService`; batch jobs in `META-INF/batch-jobs/*.xml` |
| Messages | what the system refuses, in the words the user reads | `messages*.properties`, `ValidationMessages*.properties`, `FacesMessage`, `addMessage(` |
| Stored procedures and SQL | rules that live in the database, often money and status rules | `*.sql`, `*.pks`, `*.pkb`, `*.plsql`, `@NamedStoredProcedureQuery`, `CallableStatement`, `prepareCall(` |
| Named queries | what the system counts, finds and excludes | `@NamedQuery`, `@NamedNativeQuery`, `orm.xml` |

## surfaces

| Where | What it holds | How to find it |
|---|---|---|
| Facelets and JSP pages | the screens; conditions that show, hide or disable an action are rules and permissions written in the page | `.xhtml`, `.jsp`, `.jspx`; `rendered="#{`, `disabled="#{`, `readonly="#{`, `required="true"` |
| Navigation | the flows between screens | `faces-config.xml` `navigation-rule`, `from-outcome`; Seam `pages.xml` |
| Validators and converters on pages | input rules a user meets | `<f:validate`, `validator="#{`, `converter=`, `@FacesValidator`, `@FacesConverter` |
| REST and SOAP endpoints | what other systems call, and the contracts they rely on | JAX-RS routes in the facts, `@ApplicationPath`; `@WebService`, `*.wsdl`, `*.xsd` |
| Messages to other systems | events and queues other parties consume | `@MessageDriven`, `activationConfig`, `@JMSDestinationDefinition`, `Topic`, `Queue` |
| Reports and exports | documents users receive | `*.jrxml`, `JasperReports`, `.xls`/`.pdf` writers |

## design

| Where | What it holds | How to find it |
|---|---|---|
| Deployment units | the deployables and what each contains | `application.xml`, `pom.xml` `<packaging>` (`ear`, `war`, `ejb`), `<module>` |
| Security | who may do what; the roles and the resources they guard | `@RolesAllowed`, `@PermitAll`, `@DenyAll`, `@RunAs`, `isUserInRole(`, `isCallerInRole(`; `web.xml` `security-constraint`, `security-role`, `login-config`; `ejb-jar.xml` `method-permission` |
| Transactions | what happens as one unit and what may half-happen | `@TransactionAttribute`, `@Transactional`, `TransactionAttributeType`; a call between two methods of the same bean bypasses the container |
| Stores | persistence units, data sources and what lives in each | `persistence.xml` `persistence-unit`, `jta-data-source`; `@DataSourceDefinition`; `@PersistenceContext(unitName` |
| Cross-cutting behaviour | audit, logging, checks applied around calls | `@Interceptor`, `@Interceptors`, `@AroundInvoke`, `beans.xml` `interceptors`, servlet filters in `web.xml` |
| Configuration | what operators set and what it changes | `@Resource(lookup`, JNDI names, `env-entry`, `*.properties` read at startup |

## Pitfalls

- A permission written as `rendered="#{…}"` on a page is a rule even when no server-side check
  repeats it. When the server does not repeat it, that difference is a question, not a fact to
  smooth over.
- A class named `*Bean` may be a JSF backing bean or a session bean: the annotation or the
  descriptor entry decides, not the name.
- Generated code (JAXB, `wsimport`, `generated-sources`) restates a contract; read the WSDL or XSD
  it was generated from.
- A rule enforced only in a stored procedure is still a rule of the system: cite the SQL file.
