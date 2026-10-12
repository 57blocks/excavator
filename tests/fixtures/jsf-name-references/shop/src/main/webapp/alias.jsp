<%@ taglib prefix="t" uri="http://myfaces.apache.org/tomahawk" %>
<t:aliasBean alias="#{customerBean}" value="#{orders}">
  ${customerBean.name}
</t:aliasBean>
