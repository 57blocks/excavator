<%@ page import="com.acme.shop.OrderBean" %>
<%-- ${orders.hidden} --%>
<% String s = "${orders.scripted}"; %>
<c:out value="${orders.total}"/>
<c:out value="${checkoutBean.title}"/>
