<?php

trait Greets
{
    public function hello(): string
    {
        return 'hi';
    }
}

enum Status: string
{
    case Draft = 'draft';

    public function label(): string
    {
        return 'Draft';
    }
}

class Holder
{
    public function make()
    {
        return new class {
            public function run(): int
            {
                return 1;
            }
        };
    }
}
