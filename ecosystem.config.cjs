module.exports = {
  apps: [
    {
      name: 'webapp-spring',
      script: '/home/user/.jdks/jdk-17.0.20+8/bin/java',
      args: '-jar /home/user/webapp/target/webapp-0.0.1-SNAPSHOT.jar',
      env: {
        JAVA_HOME: '/home/user/.jdks/jdk-17.0.20+8',
        DB_URL: 'jdbc:mariadb://127.0.0.1:3306/webapp',
        DB_USERNAME: 'webapp',
        DB_PASSWORD: 'webapp',
        SERVER_PORT: '8080'
      },
      watch: false,
      instances: 1
    }
  ]
}
