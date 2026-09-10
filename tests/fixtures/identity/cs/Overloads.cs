namespace Fixtures
{
    public class Overloads
    {
        public string Get(string key)
        {
            return key;
        }

        public string Get(int index)
        {
            return index.ToString();
        }
    }

    public class Other
    {
        public string Get(string key)
        {
            return key;
        }
    }
}
