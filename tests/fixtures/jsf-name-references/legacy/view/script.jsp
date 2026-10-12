<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
<script type="text/javascript">
<c:forEach items="${paramValues.to}" var="mailer">
  send('${mailer.name}');
</c:forEach>
</script>
