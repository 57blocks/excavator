'use strict';

const sql = 'SELECT * FROM orders WHERE id = 1';
const usersTable = 'users';
const joined = `
  select o.id
    from "public"."users" u
    join invoices i on i.id = u.id
`;
