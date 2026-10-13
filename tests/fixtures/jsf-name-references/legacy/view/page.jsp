<%-- ${orderHome.hidden} --%>
<% out.print("${currentOrder.scripted}"); %>
<c:out value="${mailer.name}"/>
<div title="<h:outputText value="#{mailer.subject}"/>">x</div>
