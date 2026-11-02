// Order form rules
const form = {
  title: 'New Order',
  fields: [
    { label: 'Customer Name', required: true },
    { label: 'Item Count', max: 35000 },
  ],
};
const MAX_UPLOAD = 100_000;
const statuses = ['Draft', 'Submitted'];

module.exports = { form, MAX_UPLOAD, statuses };
