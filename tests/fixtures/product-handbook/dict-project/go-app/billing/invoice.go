package billing

// InvoiceState is the lifecycle of an invoice.
type InvoiceState string

const (
	InvoiceOpen InvoiceState = "open"
	InvoicePaid InvoiceState = "paid"
	InvoiceVoid InvoiceState = "void"
)
